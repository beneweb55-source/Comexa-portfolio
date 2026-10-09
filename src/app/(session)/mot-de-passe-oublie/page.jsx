"use client";

import { useState } from "react";
import Link from "next/link";
import AuthCard, { Field } from "@/components/auth/AuthCard";
import { Notice, inputClass, primaryButton } from "@/components/workspace/ui";
import { apiFetch, messageOf } from "@/lib/api";

export default function MotDePasseOubliePage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await apiFetch("/auth/forgot-password", { method: "POST", body: { email: email.trim() } });
      setDone(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      title="Mot de passe oublié"
      intro="Indiquez votre adresse e-mail : si un compte existe, nous vous envoyons un lien pour choisir un nouveau mot de passe."
      footer={
        <Link href="/connexion" className="font-medium text-[#1683E5] hover:underline">
          Retour à la connexion
        </Link>
      }
    >
      {done ? (
        <Notice tone="info">Si cette adresse est enregistrée, un lien de réinitialisation vient d’être envoyé.</Notice>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          {error ? <Notice>{messageOf(error)}</Notice> : null}
          <Field id="email" label="Adresse e-mail">
            <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} />
          </Field>
          <button type="submit" disabled={pending} className={primaryButton}>
            {pending ? "Envoi…" : "Envoyer le lien"}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
