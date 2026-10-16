"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock, Mail, Send, ShieldCheck, UserPlus } from "lucide-react";
import { apiFetch, messageOf } from "@/lib/api";
import { SITE_CONTACT } from "@/lib/site";
import { Faq, SectionHead, Steps } from "@/components/public/PublicBlocks";

/**
 * Page « Contact ». Seul le formulaire lit l'adresse (`?sujet=`, `?pack=`) : il est
 * donc le seul bloc rendu côté navigateur (dans <Suspense>). L'introduction, les
 * canaux, les étapes et la FAQ (lue côté serveur dans `app/contact/page.jsx`) font
 * partie du HTML initial.
 */

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
    value: SITE_CONTACT.email,
    sub: SITE_CONTACT.responseTime,
    href: `mailto:${SITE_CONTACT.email}`,
  },
  {
    icon: Clock,
    title: "Horaires de l’équipe",
    value: SITE_CONTACT.hours,
    sub: SITE_CONTACT.hoursNote,
  },
  {
    icon: ShieldCheck,
    title: "Confidentialité garantie",
    value: "Échanges protégés & chiffrés",
    sub: "Possibilité de signer un accord de confidentialité (NDA) dès le premier échange",
  },
];

const PROCESS_STEPS = [
  {
    title: "Qualification sous 48 h",
    description: "Un chef de projet analyse votre demande et vérifie l’adéquation technique et budgétaire.",
  },
  {
    title: "Échange de cadrage",
    description: "Un point court de 30 minutes en visioconférence pour clarifier vos objectifs et vos délais.",
  },
  {
    title: "Proposition & espace client",
    description: "Vous recevez un devis détaillé et suivez l’ensemble du projet dans votre espace Comexa.",
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

function ContactForm() {
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
        // Le consentement est exigé ici (case obligatoire) mais n'est pas un champ de
        // l'API : elle refuse toute propriété inconnue (400), comme le faisait l'ancien envoi.
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

  if (confirmation) {
    return (
      <div className="cx-pub-form-card" role="status">
        <div className="cx-pub-form-card__head">
          <div className="flex items-start gap-4">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--comexa-success-bg)] text-[var(--comexa-success)]">
              <CheckCircle2 size={24} strokeWidth={2} aria-hidden="true" />
            </span>
            <div>
              <p className="cx-pub-label" style={{ marginBottom: 4 }}>
                Demande enregistrée
              </p>
              <h2 className="cx-pub-form-card__title">Merci {confirmation.firstName}, votre message est bien transmis.</h2>
            </div>
          </div>
        </div>

        <p className="cx-pub-status">
          Notre équipe examine votre demande et vous répondra à l’adresse{" "}
          <strong className="text-[var(--comexa-ink)]">{confirmation.email}</strong> sous 24 à 48 heures ouvrées.
        </p>

        {confirmation.reference ? (
          <div className="rounded-2xl border border-[var(--comexa-border-soft)] bg-[var(--comexa-neutral-50)] p-4">
            <span className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-[var(--comexa-ink-muted)]">
              Référence de suivi
            </span>
            <p className="cx-tabular mt-1 font-mono text-[17px] font-bold text-[var(--comexa-ink)]">
              {confirmation.reference}
            </p>
          </div>
        ) : null}

        <div className="cx-pub-cta-row">
          <Link href="/realisations" className="cx-btn cx-btn--accent cx-btn--lg">
            Découvrir nos réalisations
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <button type="button" onClick={() => setConfirmation(null)} className="cx-btn cx-btn--secondary cx-btn--lg">
            Envoyer une autre demande
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="cx-pub-form-card" aria-labelledby="contact-form-title">
      <div className="cx-pub-form-card__head">
        <div>
          <h2 id="contact-form-title" className="cx-pub-form-card__title">
            Décrivez votre projet
          </h2>
          <p className="cx-pub-form-card__hint">
            Les champs marqués d’un astérisque (*) sont nécessaires pour vous répondre.
          </p>
        </div>
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
            placeholder="Ex. Refonte de site vitrine"
            value={form.subject}
            onChange={(e) => updateField("subject", e.target.value)}
            className="cx-input"
          />
        </div>
      </div>

      {/* Sélection rapide du sujet */}
      <div className="flex flex-col gap-2">
        <span id="contact-presets" className="text-[12.5px] font-semibold text-[var(--comexa-ink-muted)]">
          Sujets fréquents
        </span>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby="contact-presets">
          {SUBJECT_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={form.subject === preset}
              onClick={() => updateField("subject", preset)}
              className="cx-pub-pill"
            >
              {preset}
            </button>
          ))}
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
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--comexa-border-soft)] bg-[var(--comexa-neutral-50)] p-3.5 text-[13.5px] leading-relaxed text-[var(--comexa-ink-soft)]">
          <input
            type="checkbox"
            checked={form.consent}
            onChange={(e) => {
              updateField("consent", e.target.checked);
              markTouched("consent");
            }}
            aria-invalid={Boolean(touched.consent && errors.consent)}
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--comexa-accent)]"
          />
          <span>
            J’accepte que les informations saisies soient utilisées par Comexa uniquement pour étudier ma demande et me
            recontacter. *
          </span>
        </label>
        {touched.consent && errors.consent ? (
          <p role="alert" className="cx-field-error">
            {errors.consent}
          </p>
        ) : null}
      </div>

      <div className="cx-pub-form-card__foot">
        <p>Aucune prospection automatisée : votre demande est lue par un membre de l’équipe.</p>
        <button type="submit" disabled={busy} className="cx-btn cx-btn--accent cx-btn--lg">
          <Send size={16} aria-hidden="true" />
          <span>{busy ? "Envoi en cours…" : "Envoyer ma demande"}</span>
        </button>
      </div>
    </form>
  );
}

/** Cadre du formulaire pendant son chargement : même carte, pas de saut de mise en page. */
function FormFallback() {
  return (
    <div className="cx-pub-form-card" style={{ minHeight: 640 }} aria-busy="true">
      <div className="cx-pub-form-card__head">
        <div>
          <p className="cx-pub-form-card__title">Décrivez votre projet</p>
          <p className="cx-pub-form-card__hint">Chargement du formulaire…</p>
        </div>
      </div>
    </div>
  );
}

export default function ContactView({ apiFaqs }) {
  const faqs = (apiFaqs?.items ?? []).filter((item) => item.question && item.answer);

  return (
    <main id="contenu" tabIndex={-1}>
      <section className="cx-pub-page-hero" aria-labelledby="page-title">
        <div className="cx-pub-container cx-pub-contact">
          <div className="cx-pub-contact__intro cx-pub-page-hero__copy cx-pub-enter">
            <nav aria-label="Fil d’Ariane" className="cx-pub-crumbs">
              <Link href="/">Accueil</Link>
              <span aria-hidden="true">›</span>
              <span aria-current="page">Contact</span>
            </nav>
            <p className="cx-pub-eyebrow">Parlons de votre projet</p>
            <h1 id="page-title" className="cx-pub-page-hero__title">
              Un interlocuteur dédié pour cadrer votre besoin.
            </h1>
            <p className="cx-pub-lead">
              Décrivez-nous votre contexte, vos objectifs ou le pack qui vous intéresse. Notre équipe revient vers vous
              sous 24 à 48 heures ouvrées avec une réponse structurée.
            </p>
          </div>

          <div className="cx-pub-contact__form">
            <Suspense fallback={<FormFallback />}>
              <ContactForm />
            </Suspense>
          </div>

          <aside className="cx-pub-contact__aside" aria-label="Autres moyens de nous joindre">
            <div className="cx-pub-card">
              <ul className="cx-pub-channels">
                {CONTACT_CHANNELS.map((channel) => {
                  const Icon = channel.icon;
                  return (
                    <li key={channel.title}>
                      <span className="cx-pub-icon" aria-hidden="true">
                        <Icon size={19} strokeWidth={1.8} />
                      </span>
                      <div className="min-w-0">
                        <p className="cx-pub-channels__label">{channel.title}</p>
                        {channel.href ? (
                          <a href={channel.href} className="cx-pub-channels__value">
                            {channel.value}
                          </a>
                        ) : (
                          <p className="cx-pub-channels__value">{channel.value}</p>
                        )}
                        <p className="cx-pub-channels__sub">{channel.sub}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="cx-pub-card">
              <div className="flex items-start gap-4">
                <span className="cx-pub-icon" aria-hidden="true">
                  <UserPlus size={19} strokeWidth={1.8} />
                </span>
                <div>
                  <h2 className="text-[17px] leading-snug">Vous préférez commander en ligne ?</h2>
                  <p className="mt-1">
                    Créez votre espace client en 1 minute pour commander directement un pack tarifé et suivre
                    l’avancement de votre projet.
                  </p>
                </div>
              </div>
              <div className="cx-pub-cta-row">
                <Link href="/inscription" className="cx-btn cx-btn--secondary">
                  Créer mon espace client
                </Link>
                <Link href="/services" className="cx-pub-link">
                  Voir nos services <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="cx-pub-section cx-pub-section--alt" aria-labelledby="process-title">
        <div className="cx-pub-container">
          <SectionHead
            eyebrow="Après votre message"
            titleId="process-title"
            title="Que se passe-t-il une fois votre demande envoyée ?"
          />
          <Steps items={PROCESS_STEPS} row />
        </div>
      </section>

      {faqs.length > 0 ? (
        <section className="cx-pub-section" aria-labelledby="faq-title">
          <div className="cx-pub-container cx-pub-split">
            <div className="cx-pub-split__intro">
              <SectionHead eyebrow="Questions fréquentes" titleId="faq-title" title="Réponses rapides avant de démarrer" />
              <p>
                Vous ne trouvez pas votre réponse ? Écrivez-nous à{" "}
                <a href={`mailto:${SITE_CONTACT.email}`} className="font-semibold text-[var(--comexa-accent-text)] underline underline-offset-4">
                  {SITE_CONTACT.email}
                </a>{" "}
                : un membre de l’équipe vous répond.
              </p>
            </div>
            <Faq items={faqs.slice(0, 8)} name="faq-contact" />
          </div>
        </section>
      ) : null}
    </main>
  );
}
