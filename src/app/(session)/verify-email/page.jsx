"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import AuthCard, { Field } from "@/components/auth/AuthCard";
import { Notice, inputClass, primaryButton } from "@/components/workspace/ui";
import { apiFetch, messageOf } from "@/lib/api";

/**
 * Page cible du lien envoye par e-mail (`/verify-email?token=...`).
 * Le jeton est a usage unique : la verification n'est lancee qu'une fois, meme
 * en double montage (mode strict de React), sinon le second appel echouerait
 * et afficherait une erreur apres un succes.
 */
const subscribeToLocation = () => () => {};
const readSearch = () => window.location.search;
const serverSearch = () => "";

export default function VerifyEmailPage() {
  // Lecture de l'URL sans effet : aucun setState n'est appele pendant le rendu ou l'effet.
  const search = useSyncExternalStore(subscribeToLocation, readSearch, serverSearch);
  const token = new URLSearchParams(search).get("token");
  // Resultat de la verification, renseigne seulement dans les callbacks de la requete.
  const [outcome, setOutcome] = useState(null); // null | { ok: true } | { ok: false, error }
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    apiFetch("/auth/verify-email", { method: "POST", body: { token } })
      .then(() => setOutcome({ ok: true }))
      .catch((caught) => setOutcome({ ok: false, error: caught }));
  }, [token]);

  const phase = outcome ? (outcome.ok ? "verified" : "failed") : token ? "verifying" : "idle";

  async function handleResend(event) {
    event.preventDefault();
    setPending(true);
    try {
      await apiFetch("/auth/resend-verification", { method: "POST", body: { email: email.trim() } });
    } catch (caught) {
      setError(caught);
      setPending(false);
      return;
    }
    setPending(false);
    setSent(true);
  }

  if (phase === "verifying") {
    return (
      <AuthCard title="Vérification en cours…">
        <p className="text-[15px] text-[var(--comexa-ink-soft)]" role="status">
          Nous vérifions votre adresse e-mail.
        </p>
      </AuthCard>
    );
  }

  if (phase === "verified") {
    return (
      <AuthCard
        title="Adresse vérifiée"
        intro="Votre compte est activé. Vous pouvez maintenant vous connecter."
      >
        <Link href="/connexion" className={primaryButton}>
          Se connecter
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Vérifier votre e-mail"
      intro={
        phase === "failed"
          ? "Ce lien ne permet plus d'activer votre compte. Demandez-en un nouveau ci-dessous."
          : "Ouvrez le lien reçu par e-mail pour activer votre compte, ou demandez un nouveau lien."
      }
    >
      <div className="flex flex-col gap-5">
        {phase === "failed" ? <Notice>{messageOf(outcome.error)}</Notice> : null}
        {sent ? (
          <Notice tone="info">Si cette adresse est enregistrée, un nouveau lien vient d’être envoyé.</Notice>
        ) : (
          <form onSubmit={handleResend} className="flex flex-col gap-5" noValidate>
            {error ? <Notice>{messageOf(error)}</Notice> : null}
            <Field id="email" label="Adresse e-mail du compte">
              <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} />
            </Field>
            <button type="submit" disabled={pending} className={primaryButton}>
              {pending ? "Envoi…" : "Recevoir un nouveau lien"}
            </button>
          </form>
        )}
        <p className="text-center text-[14px]">
          <Link href="/connexion" className="text-[var(--comexa-accent-strong)] hover:underline">
            Retour à la connexion
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}
