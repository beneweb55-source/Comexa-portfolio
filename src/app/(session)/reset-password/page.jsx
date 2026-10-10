"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AuthCard, { Field } from "@/components/auth/AuthCard";
import { Notice, inputClass, primaryButton } from "@/components/workspace/ui";
import { apiFetch, messageOf } from "@/lib/api";

/** Page cible du lien `/reset-password?token=...` envoye par e-mail. */
export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError(new Error("La confirmation ne correspond pas au mot de passe."));
      return;
    }
    setPending(true);
    try {
      await apiFetch("/auth/reset-password", {
        method: "POST",
        body: { token, password, confirmPassword },
      });
      setDone(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <AuthCard title="Mot de passe modifié" intro="Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.">
        <Link href="/connexion" className={primaryButton}>
          Se connecter
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Nouveau mot de passe" intro="Choisissez un mot de passe d'au moins 12 caractères, avec une majuscule, une minuscule et un chiffre.">
      {!token ? (
        <Notice>Ce lien est incomplet. Demandez un nouveau lien depuis la page « Mot de passe oublié ».</Notice>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          {error ? <Notice>{messageOf(error)}</Notice> : null}
          <Field id="password" label="Nouveau mot de passe">
            <input id="password" type="password" autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} />
          </Field>
          <Field id="confirmPassword" label="Confirmez le mot de passe">
            <input id="confirmPassword" type="password" autoComplete="new-password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className={inputClass} />
          </Field>
          <button type="submit" disabled={pending} className={primaryButton}>
            {pending ? "Enregistrement…" : "Enregistrer"}
          </button>
        </form>
      )}
    </AuthCard>
  );
}
