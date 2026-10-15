"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  HelpCircle,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Send,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { apiFetch, messageOf } from "@/lib/api";

const STORAGE_KEY = "comexa_contact_draft_v1";

const SUBJECT_PRESETS = [
  "Création ou refonte de site web",
  "Identité visuelle & Branding",
  "Application web ou mobile sur mesure",
  "Stratégie digitale & Acquisition",
  "Partenariat",
  "Autre projet",
];

const CONTACT_CHANNELS = [
  {
    icon: Mail,
    title: "Courriel direct",
    value: "contact@comexa.dz",
    sub: "Réponse sous 24 à 48 h ouvrées",
    href: "mailto:contact@comexa.dz",
  },
  {
    icon: Clock,
    title: "Horaires de l’équipe",
    value: "Dimanche – Jeudi · 9h00 – 18h00",
    sub: "Fuseau d’Alger (UTC+1) & accompagnement international",
  },
  {
    icon: ShieldCheck,
    title: "Confidentialité garantie",
    value: "Échanges protégés & chiffrés",
    sub: "Possibilité de signer un accord de confidentialité (NDA) dès le 1er échange",
  },
];

const PROCESS_STEPS = [
  {
    step: "01",
    title: "Qualification sous 48 h",
    text: "Un chef de projet analyse votre demande et vérifie l’adéquation technique et budgétaire.",
  },
  {
    step: "02",
    title: "Échange de cadrage",
    text: "Un point court de 30 minutes en visioconférence pour clarifier vos objectifs et vos délais.",
  },
  {
    step: "03",
    title: "Proposition & Espace client",
    text: "Vous recevez un devis détaillé et suivez l’ensemble du projet dans votre espace Comexa.",
  },
];

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  companyName: "",
  subject: "",
  message: "",
  consent: false,
};

function ContactFormContent({ faqs = [] }) {
  const searchParams = useSearchParams();
  const packParam = searchParams.get("pack");
  const subjectParam = searchParams.get("sujet");

  const [form, setForm] = useState(() => {
    const defaultSubject = packParam ? `Pack ${packParam}` : subjectParam ?? "";
    if (typeof window !== "undefined") {
      try {
        const saved = window.sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          return {
            ...EMPTY_FORM,
            ...parsed,
            subject: packParam ? `Pack ${packParam}` : subjectParam || parsed.subject || defaultSubject,
          };
        }
      } catch {
        // ignore storage errors
      }
    }
    return {
      ...EMPTY_FORM,
      subject: defaultSubject,
    };
  });
  const [touched, setTouched] = useState({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [confirmation, setConfirmation] = useState(null);

  // Sauvegarde automatique du brouillon
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    } catch {
      // ignore
    }
  }, [form]);

  const errors = useMemo(() => {
    const out = {};
    if (form.firstName.trim().length < 2) {
      out.firstName = "Indiquez votre prénom (2 caractères minimum).";
    }
    if (form.lastName.trim().length < 2) {
      out.lastName = "Indiquez votre nom (2 caractères minimum).";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      out.email = "Indiquez une adresse e-mail valide (ex. nom@entreprise.com).";
    }
    if (form.message.trim().length < 10) {
      out.message = "Décrivez brièvement votre besoin (10 caractères minimum).";
    }
    if (!form.consent) {
      out.consent = "Veuillez accepter d’être recontacté par l’équipe Comexa.";
    }
    return out;
  }, [form]);

  const isValid = Object.keys(errors).length === 0;

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function markTouched(name) {
    setTouched((current) => ({ ...current, [name]: true }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setTouched({
      firstName: true,
      lastName: true,
      email: true,
      message: true,
      consent: true,
    });
    if (!isValid || busy) return;

    setBusy(true);
    setSubmitError(null);
    try {
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        ...(form.companyName.trim() ? { companyName: form.companyName.trim() } : {}),
        ...(form.subject.trim() ? { subject: form.subject.trim() } : {}),
        message: form.message.trim(),
        source: "site-contact",
        consent: true,
      };
      const { data } = await apiFetch("/public/contact-requests", {
        method: "POST",
        body: payload,
      });
      setConfirmation({
        reference: data?.reference ?? null,
        firstName: form.firstName.trim(),
        email: form.email.trim(),
      });
      setForm(EMPTY_FORM);
      setTouched({});
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    } catch (caught) {
      setSubmitError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* ====================================================================
          1. HERO & FORMULAIRE INTERACTIF
         ==================================================================== */}
      <section className="cx-pub-hero">
        <div className="cx-container">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-start">
            {/* Colonne gauche : contexte, canaux et étapes */}
            <div className="flex flex-col gap-6 lg:col-span-5">
              <div className="flex flex-col items-start gap-4">
                <span className="cx-eyebrow">Parlons de votre projet</span>
                <h1 className="cx-h1 !text-[clamp(2rem,3.4vw,2.85rem)]">
                  Un interlocuteur dédié pour cadrer votre besoin.
                </h1>
                <p className="cx-lead">
                  Décrivez-nous votre contexte, vos objectifs ou le pack qui vous intéresse. Notre
                  équipe revient vers vous sous 24 à 48 heures ouvrées avec une réponse structurée.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                {CONTACT_CHANNELS.map((channel) => {
                  const Icon = channel.icon;
                  return (
                    <div
                      key={channel.title}
                      className="cx-card flex items-start gap-4 !p-4"
                    >
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--comexa-blue-50)] text-[var(--comexa-accent-strong)]">
                        <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-[var(--comexa-ink-muted)]">
                          {channel.title}
                        </p>
                        {channel.href ? (
                          <a
                            href={channel.href}
                            className="mt-0.5 block text-[15px] font-bold text-[var(--comexa-ink)] hover:text-[var(--comexa-accent)] hover:underline"
                          >
                            {channel.value}
                          </a>
                        ) : (
                          <p className="mt-0.5 text-[15px] font-bold text-[var(--comexa-ink)]">
                            {channel.value}
                          </p>
                        )}
                        <p className="cx-small mt-0.5">{channel.sub}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="cx-card cx-card--muted !p-5">
                <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--comexa-accent-strong)]">
                  Vous préférez commander en ligne ?
                </p>
                <p className="cx-small mt-1.5">
                  Créez votre espace client en 1 minute pour commander directement un pack tarifé et
                  suivre l’avancement de votre projet.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href="/inscription" className="cx-btn cx-btn--secondary cx-btn--sm">
                    Créer mon espace client
                  </Link>
                  <Link href="/services" className="cx-btn cx-btn--ghost cx-btn--sm">
                    Comparer les packs →
                  </Link>
                </div>
              </div>
            </div>

            {/* Colonne droite : Formulaire Liquid Glass avec validation temps réel */}
            <div className="lg:col-span-7">
              {confirmation ? (
                <div className="cx-card cx-card--accent flex flex-col gap-5 !p-8">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--comexa-success-bg)] text-[var(--comexa-success)]">
                      <CheckCircle2 size={24} strokeWidth={2} aria-hidden="true" />
                    </span>
                    <div>
                      <span className="cx-badge cx-badge--success">Demande enregistrée</span>
                      <h2 className="cx-h3 mt-1">
                        Merci {confirmation.firstName}, votre message est bien transmis.
                      </h2>
                    </div>
                  </div>

                  <p className="cx-body">
                    Notre équipe examine votre demande et vous répondra à l’adresse{" "}
                    <strong className="text-[var(--comexa-ink)]">{confirmation.email}</strong> sous
                    24 à 48 heures ouvrées.
                  </p>

                  {confirmation.reference ? (
                    <div className="rounded-2xl border border-[var(--comexa-border-soft)] bg-white/90 p-4">
                      <span className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-[var(--comexa-ink-muted)]">
                        Référence de suivi
                      </span>
                      <p className="cx-tabular mt-1 font-mono text-[17px] font-bold text-[var(--comexa-ink)]">
                        {confirmation.reference}
                      </p>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setConfirmation(null)}
                      className="cx-btn cx-btn--secondary"
                    >
                      Envoyer une autre demande
                    </button>
                    <Link href="/realisations" className="cx-btn cx-btn--primary">
                      Découvrir nos réalisations
                      <ArrowRight size={15} aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={handleSubmit}
                  noValidate
                  className="cx-card flex flex-col gap-6 !p-6 sm:!p-8"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--comexa-border-soft)] pb-4">
                    <div>
                      <h2 className="cx-h3">Formulaire de prise de contact</h2>
                      <p className="cx-small mt-0.5">
                        Les champs marqués d’un astérisque (*) sont nécessaires pour vous répondre.
                      </p>
                    </div>
                    <span className="cx-badge cx-badge--info">Réponse 24–48 h</span>
                  </div>

                  {submitError ? (
                    <div role="alert" className="cx-alert cx-alert--error">
                      {submitError}
                    </div>
                  ) : null}

                  {/* Groupe 1 : Identité & Coordonnées */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="cx-field">
                      <label htmlFor="contact-firstName" className="cx-label flex items-center justify-between">
                        <span>Prénom *</span>
                        {!errors.firstName && form.firstName.trim().length >= 2 ? (
                          <CheckCircle2 size={14} className="text-[var(--comexa-success)]" aria-hidden="true" />
                        ) : null}
                      </label>
                      <input
                        id="contact-firstName"
                        type="text"
                        required
                        maxLength={120}
                        autoComplete="given-name"
                        placeholder="Ex. Amine"
                        value={form.firstName}
                        onBlur={() => markTouched("firstName")}
                        onChange={(e) => updateField("firstName", e.target.value)}
                        aria-invalid={Boolean(touched.firstName && errors.firstName)}
                        className="cx-input"
                      />
                      {touched.firstName && errors.firstName ? (
                        <p role="alert" className="cx-field-error">
                          {errors.firstName}
                        </p>
                      ) : null}
                    </div>

                    <div className="cx-field">
                      <label htmlFor="contact-lastName" className="cx-label flex items-center justify-between">
                        <span>Nom *</span>
                        {!errors.lastName && form.lastName.trim().length >= 2 ? (
                          <CheckCircle2 size={14} className="text-[var(--comexa-success)]" aria-hidden="true" />
                        ) : null}
                      </label>
                      <input
                        id="contact-lastName"
                        type="text"
                        required
                        maxLength={120}
                        autoComplete="family-name"
                        placeholder="Ex. Benali"
                        value={form.lastName}
                        onBlur={() => markTouched("lastName")}
                        onChange={(e) => updateField("lastName", e.target.value)}
                        aria-invalid={Boolean(touched.lastName && errors.lastName)}
                        className="cx-input"
                      />
                      {touched.lastName && errors.lastName ? (
                        <p role="alert" className="cx-field-error">
                          {errors.lastName}
                        </p>
                      ) : null}
                    </div>

                    <div className="cx-field">
                      <label htmlFor="contact-email" className="cx-label flex items-center justify-between">
                        <span>E-mail professionnel *</span>
                        {!errors.email && form.email.trim() ? (
                          <CheckCircle2 size={14} className="text-[var(--comexa-success)]" aria-hidden="true" />
                        ) : null}
                      </label>
                      <input
                        id="contact-email"
                        type="email"
                        required
                        maxLength={320}
                        autoComplete="email"
                        placeholder="vous@entreprise.com"
                        value={form.email}
                        onBlur={() => markTouched("email")}
                        onChange={(e) => updateField("email", e.target.value)}
                        aria-invalid={Boolean(touched.email && errors.email)}
                        className="cx-input"
                      />
                      {touched.email && errors.email ? (
                        <p role="alert" className="cx-field-error">
                          {errors.email}
                        </p>
                      ) : null}
                    </div>

                    <div className="cx-field">
                      <label htmlFor="contact-phone" className="cx-label">
                        Téléphone <span className="font-normal text-[var(--comexa-ink-muted)]">(facultatif)</span>
                      </label>
                      <input
                        id="contact-phone"
                        type="tel"
                        maxLength={40}
                        autoComplete="tel"
                        placeholder="+213 … ou +33 …"
                        value={form.phone}
                        onChange={(e) => updateField("phone", e.target.value)}
                        className="cx-input"
                      />
                    </div>
                  </div>

                  {/* Groupe 2 : Entreprise & Sujet */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="cx-field">
                      <label htmlFor="contact-company" className="cx-label">
                        Entreprise / Organisation{" "}
                        <span className="font-normal text-[var(--comexa-ink-muted)]">(facultatif)</span>
                      </label>
                      <input
                        id="contact-company"
                        type="text"
                        maxLength={200}
                        autoComplete="organization"
                        placeholder="Nom de votre société"
                        value={form.companyName}
                        onChange={(e) => updateField("companyName", e.target.value)}
                        className="cx-input"
                      />
                    </div>

                    <div className="cx-field">
                      <label htmlFor="contact-subject" className="cx-label">
                        Objet de la demande
                      </label>
                      <input
                        id="contact-subject"
                        type="text"
                        maxLength={200}
                        placeholder="Ex. Refonte site vitrine, Pack Croissance…"
                        value={form.subject}
                        onChange={(e) => updateField("subject", e.target.value)}
                        className="cx-input"
                      />
                    </div>
                  </div>

                  {/* Pilules de sélection rapide du sujet */}
                  <div className="flex flex-col gap-2">
                    <span className="text-[12px] font-semibold text-[var(--comexa-ink-muted)]">
                      Sujets fréquents :
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {SUBJECT_PRESETS.map((preset) => {
                        const active = form.subject === preset;
                        return (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => updateField("subject", preset)}
                            className={`rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-all ${
                              active
                                ? "border-[var(--comexa-ink)] bg-[var(--comexa-ink)] text-white shadow-xs"
                                : "border-[var(--comexa-border)] bg-white text-[var(--comexa-ink-soft)] hover:border-[var(--comexa-accent)] hover:text-[var(--comexa-ink)]"
                            }`}
                          >
                            {preset}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Groupe 3 : Message */}
                  <div className="cx-field">
                    <div className="flex items-center justify-between">
                      <label htmlFor="contact-message" className="cx-label">
                        Votre besoin *
                      </label>
                      <span className="cx-tabular text-[12px] text-[var(--comexa-ink-muted)]">
                        {form.message.length} / 5000
                      </span>
                    </div>
                    <textarea
                      id="contact-message"
                      rows={5}
                      required
                      maxLength={5000}
                      placeholder="Décrivez votre activité, vos objectifs, vos délais souhaités ou toute précision utile…"
                      value={form.message}
                      onBlur={() => markTouched("message")}
                      onChange={(e) => updateField("message", e.target.value)}
                      aria-invalid={Boolean(touched.message && errors.message)}
                      className="cx-textarea"
                    />
                    {touched.message && errors.message ? (
                      <p role="alert" className="cx-field-error">
                        {errors.message}
                      </p>
                    ) : null}
                  </div>

                  {/* Consentement */}
                  <div className="flex flex-col gap-1.5">
                    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--comexa-border-soft)] bg-[var(--comexa-surface-alt)] p-3.5 text-[13.5px] text-[var(--comexa-ink-soft)]">
                      <input
                        type="checkbox"
                        checked={form.consent}
                        onChange={(e) => {
                          updateField("consent", e.target.checked);
                          markTouched("consent");
                        }}
                        className="mt-1 h-4 w-4 shrink-0 accent-[var(--comexa-accent)]"
                      />
                      <span>
                        J’accepte que les informations saisies soient utilisées par Comexa uniquement
                        pour étudier ma demande et me recontacter. *
                      </span>
                    </label>
                    {touched.consent && errors.consent ? (
                      <p role="alert" className="cx-field-error">
                        {errors.consent}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
                    <p className="cx-small">
                      Aucune prospection automatisée : votre demande est lue par un membre de l’équipe.
                    </p>
                    <button
                      type="submit"
                      disabled={busy}
                      className="cx-btn cx-btn--primary"
                    >
                      <Send size={15} aria-hidden="true" />
                      <span>{busy ? "Envoi en cours…" : "Envoyer ma demande"}</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          2. PARCOURS DE TRAITEMENT (3 Étapes)
         ==================================================================== */}
      <section className="cx-pub-section cx-pub-section--tint">
        <div className="cx-container">
          <div className="cx-pub-section__head">
            <div>
              <span className="cx-eyebrow">Après votre message</span>
              <h2 className="cx-h2 mt-3">Que se passe-t-il une fois votre demande envoyée ?</h2>
            </div>
          </div>

          <div className="cx-pub-grid-3">
            {PROCESS_STEPS.map((item) => (
              <article key={item.step} className="cx-card flex flex-col gap-3">
                <span className="cx-tabular inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--comexa-ink)] text-[13px] font-bold text-white">
                  {item.step}
                </span>
                <h3 className="cx-h3">{item.title}</h3>
                <p className="cx-body">{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ====================================================================
          3. FAQ CONTACT (si disponible)
         ==================================================================== */}
      {faqs.length > 0 ? (
        <section className="cx-pub-section">
          <div className="cx-container">
            <div className="cx-pub-section__head">
              <div>
                <span className="cx-eyebrow">Questions fréquentes</span>
                <h2 className="cx-h2 mt-3">Réponses rapides avant de démarrer</h2>
              </div>
            </div>
            <div className="cx-pub-grid-2">
              {faqs.slice(0, 6).map((faq) => (
                <article key={faq.id ?? faq.question} className="cx-card flex flex-col gap-2">
                  <h3 className="cx-h3 !text-[16.5px]">{faq.question}</h3>
                  <p className="cx-body">{faq.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default function ContactView(props) {
  return (
    <Suspense fallback={<div className="cx-container py-16 text-sm text-[var(--comexa-ink-muted)]">Chargement…</div>}>
      <ContactFormContent {...props} />
    </Suspense>
  );
}
