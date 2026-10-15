"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, Eye, EyeOff, UserPlus } from "lucide-react";
import { AuthCard } from "@/components/auth/AuthCard";
import { messageOf } from "@/lib/api";
import { useAuth } from "@/lib/session";

const MIN_PASSWORD = 12;

function validate(form) {
  const errors = {};
  if (form.firstName.trim().length < 2) errors.firstName = "Indiquez votre prénom (2 caractères minimum).";
  if (form.lastName.trim().length < 2) errors.lastName = "Indiquez votre nom (2 caractères minimum).";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "Indiquez une adresse e-mail valide.";
  if (form.companyName.trim().length < 2) errors.companyName = "Indiquez le nom de votre entreprise.";
  if (form.password.length < MIN_PASSWORD) {
    errors.password = `Choisissez un mot de passe d’au moins ${MIN_PASSWORD} caractères.`;
  } else if (!/[a-z]/.test(form.password) || !/[A-Z]/.test(form.password) || !/\d/.test(form.password)) {
    errors.password = "Le mot de passe doit contenir une minuscule, une majuscule et un chiffre.";
  }
  return errors;
}

export default function InscriptionPage() {
  const { register, resendVerification } = useAuth();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    companyName: "",
    sector: "",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [resent, setResent] = useState(false);

  function update(field) {
    return (event) => {
      const value = event.target.value;
      setForm((current) => ({ ...current, [field]: value }));
      setFieldErrors((current) => {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
      });
    };
  }

  async function onSubmit(event) {
    event.preventDefault();
    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await register({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        companyName: form.companyName.trim(),
        sector: form.sector.trim() || undefined,
        password: form.password,
      });
      setDone(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    setBusy(true);
    setError(null);
    try {
      await resendVerification(form.email.trim());
      setResent(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  const pwChecks = [
    { label: "12+ caractères", ok: form.password.length >= MIN_PASSWORD },
    { label: "1 majuscule", ok: /[A-Z]/.test(form.password) },
    { label: "1 minuscule", ok: /[a-z]/.test(form.password) },
    { label: "1 chiffre", ok: /\d/.test(form.password) },
  ];

  if (done) {
    return (
      <AuthCard
        title="Vérifiez votre boîte e-mail"
        subtitle={`Un lien de confirmation vient d’être envoyé à ${form.email.trim()}.`}
        footer={
          <Link href="/connexion" className="font-semibold text-[var(--comexa-accent-strong)] hover:underline">
            Aller à la connexion →
          </Link>
        }
      >
        <div className="flex flex-col gap-4 text-[14.5px] leading-relaxed text-[var(--comexa-ink-soft)]">
          <p>
            Cliquez sur le lien reçu pour activer votre espace client. Une fois l’adresse confirmée,
            vous pourrez vous connecter et commander un pack ou déposer une demande de projet.
          </p>
          {error ? <p role="alert" className="cx-alert cx-alert--error">{error}</p> : null}
          {resent ? <p role="status" className="cx-alert cx-alert--success">Un nouveau lien vient d’être envoyé.</p> : null}
          <button type="button" onClick={onResend} disabled={busy} className="cx-btn cx-btn--secondary self-start">
            Renvoyer l’e-mail de confirmation
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Créer un compte client"
      subtitle="Votre espace permet de commander un pack, déposer un besoin sur mesure et suivre vos projets."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>Vous avez déjà un compte ?</span>
          <Link href="/connexion" className="font-semibold text-[var(--comexa-accent-strong)] hover:underline">
            Se connecter →
          </Link>
        </div>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error ? <p role="alert" className="cx-alert cx-alert--error">{error}</p> : null}

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field id="firstName" label="Prénom" error={fieldErrors.firstName}>
            <input id="firstName" autoComplete="given-name" required value={form.firstName} onChange={update("firstName")} aria-invalid={Boolean(fieldErrors.firstName)} className="cx-input" />
          </Field>
          <Field id="lastName" label="Nom" error={fieldErrors.lastName}>
            <input id="lastName" autoComplete="family-name" required value={form.lastName} onChange={update("lastName")} aria-invalid={Boolean(fieldErrors.lastName)} className="cx-input" />
          </Field>
        </div>

        <Field id="email" label="E-mail professionnel" error={fieldErrors.email}>
          <input id="email" type="email" autoComplete="email" required value={form.email} onChange={update("email")} aria-invalid={Boolean(fieldErrors.email)} className="cx-input" placeholder="vous@entreprise.com" />
        </Field>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field id="companyName" label="Entreprise" error={fieldErrors.companyName}>
            <input id="companyName" autoComplete="organization" required value={form.companyName} onChange={update("companyName")} aria-invalid={Boolean(fieldErrors.companyName)} className="cx-input" />
          </Field>
          <Field id="sector" label="Secteur (facultatif)">
            <input id="sector" value={form.sector} onChange={update("sector")} className="cx-input" />
          </Field>
        </div>

        <Field id="phone" label="Téléphone (facultatif)">
          <input id="phone" type="tel" autoComplete="tel" value={form.phone} onChange={update("phone")} className="cx-input" />
        </Field>

        <Field
          id="password"
          label="Mot de passe"
          error={fieldErrors.password}
        >
          <div className="relative flex items-center">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              value={form.password}
              onChange={update("password")}
              aria-invalid={Boolean(fieldErrors.password)}
              className="cx-input !pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2.5 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--comexa-ink-muted)] hover:bg-[var(--comexa-neutral-100)] hover:text-[var(--comexa-ink)]"
              aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[12px]">
            {pwChecks.map((check) => (
              <span
                key={check.label}
                className={`inline-flex items-center gap-1.5 font-medium ${
                  check.ok ? "text-[var(--comexa-success)]" : "text-[var(--comexa-ink-muted)]"
                }`}
              >
                {check.ok ? <CheckCircle2 size={13} /> : <Circle size={12} />}
                {check.label}
              </span>
            ))}
          </div>
        </Field>

        <button type="submit" disabled={busy} className="cx-btn cx-btn--primary mt-1 w-full">
          <UserPlus size={16} aria-hidden="true" />
          <span>{busy ? "Création en cours…" : "Créer mon compte"}</span>
        </button>
      </form>
    </AuthCard>
  );
}

function Field({ id, label, hint, error, children }) {
  return (
    <div className="cx-field">
      <label htmlFor={id} className="cx-label">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="cx-hint">{hint}</p> : null}
      {error ? (
        <p role="alert" className="cx-field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
