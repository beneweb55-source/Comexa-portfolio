import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CodeXml,
  Database,
  Gauge,
  Globe,
  LayoutTemplate,
  Layers,
  Megaphone,
  Palette,
  PenTool,
  Quote,
  Rocket,
  Search,
  Server,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Store,
  Wrench,
} from "lucide-react";
import { initialsOf } from "@/lib/public-api";
import { SITE_CONTACT } from "@/lib/site";

/*
 * Blocs partagés du site public. Chaque page assemble les mêmes briques :
 * en-tête de page, en-tête de section, cartes, étapes, FAQ et carte « ink »
 * d'appel à l'action. Une seule implémentation = une seule hiérarchie visuelle.
 */

// Le champ « Icône » d'un service est un texte libre (espace équipe › Contenu) :
// les noms courants sont reconnus, sinon on affiche le numéro du service.
const SERVICE_ICONS = {
  globe: Globe,
  web: Globe,
  layout: LayoutTemplate,
  layers: Layers,
  "shopping-cart": ShoppingCart,
  cart: ShoppingCart,
  store: Store,
  palette: Palette,
  "pen-tool": PenTool,
  search: Search,
  seo: Search,
  shield: ShieldCheck,
  "shield-check": ShieldCheck,
  wrench: Wrench,
  code: CodeXml,
  smartphone: Smartphone,
  mobile: Smartphone,
  rocket: Rocket,
  megaphone: Megaphone,
  gauge: Gauge,
  server: Server,
  database: Database,
  sparkles: Sparkles,
};

export function ServiceIcon({ name, fallback }) {
  const Picto = SERVICE_ICONS[String(name ?? "").trim().toLowerCase()];
  if (!Picto) return <span className="cx-pub-icon__num">{fallback}</span>;
  return <Picto size={22} strokeWidth={1.75} aria-hidden="true" />;
}

/** Colonnes sur grand écran : jamais de carte orpheline sur une ligne. */
export function columnsFor(count) {
  if (count <= 2) return Math.max(count, 1);
  return count === 4 ? 2 : 3;
}

export function pad(number) {
  return String(number).padStart(2, "0");
}

/** Témoignage de l'API → données de carte. */
export function testimonialFromApi(item) {
  return {
    name: item.authorName,
    role: [item.authorRole, item.authorCompany].filter(Boolean).join(", "),
    text: item.quote,
  };
}

export function Facts({ items }) {
  if (!items?.length) return null;
  return (
    <ul className="cx-pub-facts">
      {items.map((item) => (
        <li key={item}>
          <Check aria-hidden="true" />
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Liste à coches (cartes, panneaux). */
export function Checks({ items, className = "" }) {
  return (
    <ul className={`cx-pub-checks ${className}`.trim()}>
      {items.map((item) => (
        <li key={item}>
          <Check aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * En-tête des pages intérieures : fil d'Ariane, sur-titre, titre, accroche,
 * un appel à l'action principal et, au besoin, un panneau à droite.
 */
export function PageHero({ current, eyebrow, title, titleId = "page-title", lead, actions = null, facts = null, aside = null }) {
  return (
    <section className={aside ? "cx-pub-page-hero cx-pub-page-hero--aside" : "cx-pub-page-hero"} aria-labelledby={titleId}>
      <div className="cx-pub-container cx-pub-page-hero__grid">
        <div className="cx-pub-page-hero__copy cx-pub-enter">
          <nav aria-label="Fil d’Ariane" className="cx-pub-crumbs">
            <Link href="/">Accueil</Link>
            <span aria-hidden="true">›</span>
            <span aria-current="page">{current}</span>
          </nav>
          <p className="cx-pub-eyebrow">{eyebrow}</p>
          <h1 id={titleId} className="cx-pub-page-hero__title">
            {title}
          </h1>
          {lead ? <p className="cx-pub-lead">{lead}</p> : null}
          {actions ? <div className="cx-pub-cta-row">{actions}</div> : null}
          <Facts items={facts} />
        </div>
        {aside ? <div className="cx-pub-page-hero__aside cx-pub-enter">{aside}</div> : null}
      </div>
    </section>
  );
}

/** En-tête de section : titre à gauche, texte et lien à droite (facultatifs). */
export function SectionHead({ eyebrow, title, titleId, children = null }) {
  return (
    <header className={children ? "cx-pub-head" : "cx-pub-head cx-pub-head--single"}>
      <div>
        <p className="cx-pub-eyebrow">{eyebrow}</p>
        <h2 id={titleId} className="cx-pub-h2">
          {title}
        </h2>
      </div>
      {children ? <div className="cx-pub-head__aside">{children}</div> : null}
    </header>
  );
}

/** Carte d'étude de cas (accueil et page Réalisations). */
export function WorkCard({ study, number, tone = 1, href }) {
  return (
    <article className={`cx-pub-work cx-pub-work--tone-${tone}`}>
      <div className="cx-pub-work__cover">
        <span className="cx-pub-work__cat">{study.category?.name ?? "Réalisation"}</span>
        <span className="cx-pub-work__index" aria-hidden="true">
          {number}
        </span>
      </div>
      <div className="cx-pub-work__body">
        {study.clientName ? <p className="cx-pub-work__client">{study.clientName}</p> : null}
        <h3>
          {href.startsWith("#") ? (
            // Ancre sur la même page : lien natif, pour que le navigateur gère le
            // défilement et la cible (:target) de l'étude de cas.
            <a href={href} className="cx-pub-work__link">
              {study.title}
            </a>
          ) : (
            <Link href={href} className="cx-pub-work__link">
              {study.title}
            </Link>
          )}
        </h3>
        {study.excerpt ? <p className="cx-pub-work__excerpt">{study.excerpt}</p> : null}
        <span className="cx-pub-work__more" aria-hidden="true">
          Lire le cas <ArrowUpRight size={16} />
        </span>
      </div>
    </article>
  );
}

/** Carte de témoignage (accueil et page Partenaires). */
export function QuoteCard({ name, role, text }) {
  return (
    <figure className="cx-pub-quote">
      <Quote className="cx-pub-quote__mark" aria-hidden="true" />
      <blockquote>
        <p>{text}</p>
      </blockquote>
      <figcaption>
        <span className="cx-pub-avatar" aria-hidden="true">
          {initialsOf(name)}
        </span>
        <span>
          <strong>{name}</strong>
          {role ? <span>{role}</span> : null}
        </span>
      </figcaption>
    </figure>
  );
}

/** Étapes numérotées reliées par un fil (verticales, ou en ligne sur grand écran). */
export function Steps({ items, row = false, level = "h3" }) {
  const Title = level;
  return (
    <ol className={row ? "cx-pub-steps cx-pub-steps--row" : "cx-pub-steps"}>
      {items.map((step, index) => (
        <li key={step.title} className="cx-pub-step">
          <span className="cx-pub-step__num" aria-hidden="true">
            {pad(index + 1)}
          </span>
          <div>
            <Title>{step.title}</Title>
            <p>{step.description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Questions fréquentes en accordéon natif (<details>) : utilisable au clavier,
 * sans JavaScript, et une seule réponse ouverte à la fois (attribut `name`).
 */
export function Faq({ items, name = "faq" }) {
  return (
    <div className="cx-pub-faq">
      {items.map((item, index) => (
        <details key={item.id ?? item.question} name={name} className="cx-pub-faq__item" open={index === 0}>
          <summary className="cx-pub-faq__question">
            <span>{item.question}</span>
            <ChevronDown className="cx-pub-faq__chevron" size={20} aria-hidden="true" />
          </summary>
          <div className="cx-pub-faq__answer">
            {String(item.answer ?? "")
              .split(/\n{2,}/)
              .map((paragraph, paragraphIndex) => (
                <p key={paragraphIndex}>{paragraph}</p>
              ))}
          </div>
        </details>
      ))}
    </div>
  );
}

/**
 * Appel à l'action de fin de page — la seule carte « ink » de la page.
 * Un bouton principal, un lien secondaire facultatif et une ligne de réassurance.
 */
export function CtaBand({ eyebrow, title, text, primary, secondary = null, titleId = "cta-title" }) {
  return (
    <section className="cx-pub-section cx-pub-section--cta" aria-labelledby={titleId}>
      <div className="cx-pub-container">
        <div className="cx-pub-cta">
          <div className="cx-pub-cta__copy">
            <p className="cx-pub-eyebrow">{eyebrow}</p>
            <h2 id={titleId} className="cx-pub-cta__title">
              {title}
            </h2>
            {text ? <p className="cx-pub-cta__text">{text}</p> : null}
          </div>
          <div className="cx-pub-cta__actions">
            <div className="cx-pub-cta-row">
              <Link href={primary.href} className="cx-btn cx-btn--accent cx-btn--lg">
                {primary.label}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              {secondary ? (
                <Link href={secondary.href} className="cx-pub-link">
                  {secondary.label} <ArrowRight size={16} aria-hidden="true" />
                </Link>
              ) : null}
            </div>
            <p className="cx-pub-cta__note">
              <Check aria-hidden="true" />
              <span>
                {SITE_CONTACT.responseTime} ·{" "}
                <a href={`mailto:${SITE_CONTACT.email}`}>{SITE_CONTACT.email}</a>
              </span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
