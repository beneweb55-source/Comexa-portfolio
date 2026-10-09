"use client";

import { useState } from "react";
import Link from "next/link";
import AuthCard, { Field } from "@/components/auth/AuthCard";
import { Notice, inputClass, primaryButton, secondaryButton } from "@/components/workspace/ui";
import { apiFetch, messageOf } from "@/lib/api";

/**
 * Pays proposes a l'inscription. Le code ISO envoye au serveur determine la devise
 * (cote serveur uniquement). Un pays absent de la liste se saisit a part.
 */
const COUNTRIES = [
  { code: "DZ", label: "Algérie" },
  { code: "FR", label: "France" },
  { code: "MA", label: "Maroc" },
  { code: "TN", label: "Tunisie" },
  { code: "BE", label: "Belgique" },
  { code: "CA", label: "Canada" },
  { code: "CH", label: "Suisse" },
  { code: "OTHER", label: "Autre pays" },
];

const EMPTY = { firstName: "", lastName: "", email: "", country: "DZ", otherCountry: "", password: "", confirmPassword: "" };

export default function InscriptionPage() {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState(null);
  const [resent, setResent] = useState(false);

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);

    const country = form.country === "OTHER" ? form.otherCountry.trim().toUpperCase() : form.country;
    if (!/^[A-Z]{2}$/.test(country)) {
      setError(new Error("Indiquez un pays avec son code à deux lettres (ex. BE)."));
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError(new Error("La confirmation ne correspond pas au mot de passe."));
      return;
    }

    setPending(true);
    try {
      await apiFetch("/auth/register", {
        method: "POST",
        body: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          country,
          password: form.password,
          confirmPassword: form.confirmPassword,
        },
      });
      setSentTo(form.email.trim());
      setForm(EMPTY);
    } catch (caught) {
      setError(caught);
      setForm((current) => ({ ...current, password: "", confirmPassword: "" }));
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    try {
      await apiFetch("/auth/resend-verification", { method: "POST", body: { email: sentTo } });
    } finally {
      // Reponse identique que le compte existe ou non : on n'informe pas sur l'adresse.
      setResent(true);
    }
  }

  if (sentTo) {
    return (
      <AuthCard
        title="Vérifiez votre e-mail"
        intro={`Un lien de vérification vient d'être envoyé à ${sentTo}.`}
        footer={
          <>
            Déjà vérifié ?{" "}
            <Link href="/connexion" className="font-medium text-[#1683E5] hover:underline">
              Se connecter
            </Link>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Notice tone="info">
            Ouvrez le message et cliquez sur le lien pour activer votre compte. Vous pourrez vous connecter
            ensuite. Le lien est valable 24 heures.
          </Notice>
          {resent ? (
            <Notice tone="info">Si cette adresse est enregistrée, un nouveau lien vient d’être envoyé.</Notice>
          ) : (
            <button type="button" onClick={resend} className={secondaryButton}>
              Je n’ai rien reçu : renvoyer le lien
            </button>
          )}
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Créer votre compte"
      intro="Votre espace client vous permet de commander un pack et de suivre votre projet. Vérifiez votre adresse e-mail pour l'activer."
      footer={
        <>
          Vous avez déjà un compte ?{" "}
          <Link href="/connexion" className="font-medium text-[#1683E5] hover:underline">
            Se connecter
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        {error ? <Notice>{messageOf(error)}</Notice> : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="firstName" label="Prénom">
            <input id="firstName" name="firstName" autoComplete="given-name" required value={form.firstName} onChange={update("firstName")} className={inputClass} />
          </Field>
          <Field id="lastName" label="Nom">
            <input id="lastName" name="lastName" autoComplete="family-name" required value={form.lastName} onChange={update("lastName")} className={inputClass} />
          </Field>
        </div>

        <Field id="email" label="Adresse e-mail">
          <input id="email" name="email" type="email" autoComplete="email" required value={form.email} onChange={update("email")} className={inputClass} />
        </Field>

        <Field id="country" label="Pays de résidence" hint="Il détermine la devise et les moyens de paiement proposés.">
          <select id="country" name="country" value={form.country} onChange={update("country")} className={inputClass}>
            {COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.label}
              </option>
            ))}
          </select>
        </Field>

        {form.country === "OTHER" ? (
          <Field id="otherCountry" label="Code pays à deux lettres" hint="Ex. BE, CA, SN.">
            <input id="otherCountry" name="otherCountry" maxLength={2} value={form.otherCountry} onChange={update("otherCountry")} className={inputClass} />
          </Field>
        ) : null}

        <Field
          id="password"
          label="Mot de passe"
          hint="12 caractères minimum, avec une majuscule, une minuscule et un chiffre."
        >
          <input id="password" name="password" type="password" autoComplete="new-password" required value={form.password} onChange={update("password")} className={inputClass} />
        </Field>

        <Field id="confirmPassword" label="Confirmez le mot de passe">
          <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required value={form.confirmPassword} onChange={update("confirmPassword")} className={inputClass} />
        </Field>

        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Création du compte…" : "Créer mon compte"}
        </button>
      </form>
    </AuthCard>
  );
}
