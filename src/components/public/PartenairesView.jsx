"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Award,
  Building2,
  CheckCircle2,
  ChevronDown,
  Globe,
  Handshake,
  HelpCircle,
  Layers,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";

const PARTNER_PILLARS = [
  {
    title: "Complémentarité métier",
    text: "Design, développement, cloud, paiement ou conseil : chaque partenaire renforce une brique précise des projets que nous livrons.",
    icon: Layers,
    badge: "Synergie",
  },
  {
    title: "Exigence de qualité",
    text: "Méthodes documentées, délais tenus, sécurité des données et interlocuteur identifié tout au long de la mission.",
    icon: ShieldCheck,
    badge: "Fiabilité",
  },
  {
    title: "Engagement dans la durée",
    text: "Nous privilégions des alliances durables plutôt que de la sous-traitance ponctuelle, pour assurer un suivi stable.",
    icon: Handshake,
    badge: "Continuité",
  },
];

const COLLABORATION_MODELS = [
  {
    step: "01",
    title: "Partenaire technologique",
    description:
      "Intégration de solutions d’hébergement, de paiement, de CRM ou d’outils métiers au cœur des plateformes que nous concevons.",
    points: [
      "Intégrations API testées et documentées",
      "Support technique conjoint",
      "Architecture évolutive et sécurisée",
    ],
  },
  {
    step: "02",
    title: "Partenaire d’expertise",
    description:
      "Intervention coordonnée sur des volets spécialisés : production audiovisuelle, juridique, cybersécurité ou stratégie média.",
    points: [
      "Un seul chef de projet côté Comexa",
      "Livrables harmonisés à votre charte",
      "Planning et jalons partagés",
    ],
  },
  {
    step: "03",
    title: "Apporteur & réseau",
    description:
      "Accompagnement croisé des entreprises qui cherchent un partenaire digital fiable en Algérie et à l’international.",
    points: [
      "Qualification rapide des besoins",
      "Proposition claire sous 48 h",
      "Suivi transparent dans l’espace dédié",
    ],
  },
];

const FALLBACK_FAQS = [
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

function initialsOf(name) {
  return (
    String(name ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "CX"
  );
}

function PartnerCard({ partner }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const hasLogo = Boolean(partner.logoUrl) && !logoFailed;

  return (
    <article className="cx-card cx-card--interactive flex flex-col justify-between gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-16 w-28 items-center justify-center overflow-hidden rounded-2xl border border-[var(--comexa-border-soft)] bg-[var(--comexa-surface-alt)] p-3">
          {hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={partner.logoUrl}
              alt={`Logo ${partner.name}`}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setLogoFailed(true)}
              className="max-h-10 w-auto max-w-full object-contain"
            />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[15px] font-bold tracking-tight text-[var(--comexa-ink)]">
              <Building2 size={17} className="text-[var(--comexa-accent)]" aria-hidden="true" />
              {initialsOf(partner.name)}
            </span>
          )}
        </div>
        <span className="cx-badge cx-badge--info">Partenaire</span>
      </div>

      <div>
        <h3 className="cx-h3">{partner.name}</h3>
        <p className="cx-small mt-1.5">
          Membre de l’écosystème de partenaires sélectionnés par Comexa.
        </p>
      </div>

      <div className="border-t border-[var(--comexa-border-soft)] pt-3.5">
        {partner.websiteUrl ? (
          <a
            href={partner.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-[var(--comexa-accent-strong)] hover:underline"
          >
            <Globe size={14} aria-hidden="true" />
            <span>Visiter le site officiel</span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--comexa-ink-muted)]">
            <Award size={14} className="text-[var(--comexa-accent)]" aria-hidden="true" />
            Partenaire référencé Comexa
          </span>
        )}
      </div>
    </article>
  );
}

export default function PartenairesView({ partners = [], faqs = [] }) {
  const faqList = faqs.length > 0 ? faqs : FALLBACK_FAQS;
  const [openFaq, setOpenFaq] = useState(faqList[0]?.id ?? null);

  return (
    <div>
      {/* ====================================================================
          1. HERO — ÉCOSYSTÈME & ALLIANCES
         ==================================================================== */}
      <section className="cx-pub-hero">
        <div className="cx-container">
          <div className="cx-pub-split">
            <div className="flex flex-col items-start gap-5">
              <span className="cx-eyebrow">Écosystème &amp; Alliances</span>
              <h1 className="cx-h1">
                Des partenaires choisis pour la qualité de leurs livrables.
              </h1>
              <p className="cx-lead">
                Pour garantir des projets fiables de bout en bout, Comexa s’entoure d’acteurs
                technologiques et métiers partageant la même rigueur d’exécution.
              </p>
              <div className="flex flex-wrap gap-3 pt-1">
                <Link href="/contact?sujet=Partenariat" className="cx-btn cx-btn--primary">
                  Proposer un partenariat
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <Link href="/realisations" className="cx-btn cx-btn--secondary">
                  Découvrir nos réalisations
                </Link>
              </div>
            </div>

            <aside className="cx-card cx-card--accent flex flex-col gap-5">
              <div className="flex items-center justify-between gap-3">
                <span className="cx-badge cx-badge--info">Réseau Comexa</span>
                <Sparkles size={18} className="text-[var(--comexa-accent)]" aria-hidden="true" />
              </div>
              <h2 className="cx-h3">
                Une direction de projet unique, des compétences démultipliées.
              </h2>
              <p className="cx-body">
                Vous conservez un interlocuteur unique chez Comexa, tout en bénéficiant
                d’intégrations certifiées et d’expertises pointues lorsque votre projet l’exige.
              </p>
              <ul className="cx-pub-checks">
                <li>Sélection sur critères techniques et méthodologiques</li>
                <li>Suivi centralisé dans votre espace client Comexa</li>
                <li>Confidentialité et respect des engagements contractuels</li>
              </ul>
            </aside>
          </div>
        </div>
      </section>

      {/* ====================================================================
          2. LISTE DES PARTENAIRES ACTIFS
         ==================================================================== */}
      <section className="cx-pub-section">
        <div className="cx-container">
          <div className="cx-pub-section__head">
            <div>
              <span className="cx-eyebrow">Ils collaborent avec nous</span>
              <h2 className="cx-h2 mt-3">Nos partenaires référencés</h2>
            </div>
            <p className="cx-body">
              Chaque structure référencée ci-dessous intervient en synergie avec nos équipes.
            </p>
          </div>

          {partners.length > 0 ? (
            <div className="cx-pub-grid-3">
              {partners.map((partner) => (
                <PartnerCard key={partner.id ?? partner.name} partner={partner} />
              ))}
            </div>
          ) : (
            <div className="cx-card flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <div className="flex items-start gap-4">
                <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--comexa-blue-50)] text-[var(--comexa-accent)]">
                  <Handshake size={22} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="cx-h3">Vous souhaitez rejoindre notre réseau de partenaires ?</h3>
                  <p className="cx-body mt-1">
                    Nous développons activement notre réseau d’experts techniques, d’éditeurs et d’agences partenaires.
                  </p>
                </div>
              </div>
              <Link href="/contact?sujet=Partenariat" className="cx-btn cx-btn--primary shrink-0">
                Prendre contact
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* ====================================================================
          3. CRITÈRES DE SÉLECTION (3 Piliers)
         ==================================================================== */}
      <section className="cx-pub-section cx-pub-section--tint">
        <div className="cx-container">
          <div className="cx-pub-section__head">
            <div>
              <span className="cx-eyebrow">Nos engagements</span>
              <h2 className="cx-h2 mt-3">Sur quelles bases travaillons-nous ensemble ?</h2>
            </div>
            <p className="cx-body">
              Un partenariat utile repose sur des processus clairs et une responsabilité partagée.
            </p>
          </div>

          <div className="cx-pub-grid-3">
            {PARTNER_PILLARS.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <article key={pillar.title} className="cx-card flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--comexa-blue-50)] text-[var(--comexa-accent-strong)]">
                      <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
                    </span>
                    <span className="cx-badge cx-badge--info">{pillar.badge}</span>
                  </div>
                  <h3 className="cx-h3">{pillar.title}</h3>
                  <p className="cx-body">{pillar.text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* ====================================================================
          4. MODÈLES DE COLLABORATION
         ==================================================================== */}
      <section className="cx-pub-section">
        <div className="cx-container">
          <div className="cx-pub-section__head">
            <div>
              <span className="cx-eyebrow">Formats d’alliance</span>
              <h2 className="cx-h2 mt-3">Trois façons de collaborer avec Comexa</h2>
            </div>
          </div>

          <div className="cx-pub-grid-3">
            {COLLABORATION_MODELS.map((model) => (
              <article key={model.step} className="cx-card cx-card--interactive flex flex-col justify-between gap-5">
                <div className="flex flex-col gap-3">
                  <span className="cx-tabular inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--comexa-ink)] text-[13px] font-bold text-white">
                    {model.step}
                  </span>
                  <h3 className="cx-h3">{model.title}</h3>
                  <p className="cx-body">{model.description}</p>
                </div>
                <ul className="cx-pub-checks border-t border-[var(--comexa-border-soft)] pt-4">
                  {model.points.map((pt) => (
                    <li key={pt}>{pt}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ====================================================================
          5. FAQ PARTENAIRES (Accordéon fluide)
         ==================================================================== */}
      <section className="cx-pub-section cx-pub-section--tint">
        <div className="cx-container">
          <div className="cx-pub-split">
            <div className="flex flex-col items-start gap-4">
              <span className="cx-eyebrow">Questions fréquentes</span>
              <h2 className="cx-h2">Tout savoir sur nos partenariats</h2>
              <p className="cx-body">
                Une question spécifique sur un appel d’offres conjoint ou une intervention en
                sous-traitance ? Écrivez-nous directement.
              </p>
              <Link href="/contact?sujet=Partenariat" className="cx-btn cx-btn--secondary mt-2">
                Poser une question à l’équipe
              </Link>
            </div>

            <div className="flex flex-col gap-3">
              {faqList.map((item) => {
                const isOpen = openFaq === item.id;
                return (
                  <div
                    key={item.id ?? item.question}
                    className="cx-card !p-0 overflow-hidden transition-all"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaq(isOpen ? null : item.id)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left font-semibold text-[var(--comexa-ink)] hover:bg-[var(--comexa-blue-50)]/40 transition-colors"
                    >
                      <span className="flex items-center gap-3 text-[15.5px]">
                        <HelpCircle size={18} className="shrink-0 text-[var(--comexa-accent)]" aria-hidden="true" />
                        <span>{item.question}</span>
                      </span>
                      <ChevronDown
                        size={18}
                        className={`shrink-0 text-[var(--comexa-ink-muted)] transition-transform duration-200 ${
                          isOpen ? "rotate-180 text-[var(--comexa-accent)]" : ""
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                    {isOpen ? (
                      <div className="border-t border-[var(--comexa-border-soft)] px-6 py-4 text-[14.5px] leading-relaxed text-[var(--comexa-ink-soft)]">
                        {item.answer}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          6. CTA BANNER
         ==================================================================== */}
      <section className="cx-pub-section">
        <div className="cx-container">
          <div className="cx-pub-cta">
            <div>
              <h2>Construisons votre prochain projet ensemble.</h2>
              <p className="mt-2">
                Que vous soyez une entreprise porteuse d’un projet ou un partenaire potentiel,
                notre équipe vous répond sous 24 à 48 heures ouvrées.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/contact?sujet=Partenariat" className="cx-btn cx-btn--accent">
                Initier un échange
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link
                href="/services"
                className="cx-btn cx-btn--secondary !bg-white/10 !text-white !border-white/25 hover:!bg-white/20"
              >
                Voir nos expertises
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
