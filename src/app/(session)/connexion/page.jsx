"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthCard, { Field } from "@/components/auth/AuthCard";
import { Notice, inputClass, primaryButton } from "@/components/workspace/ui";
import { useAuth } from "@/lib/session";
import { ApiError, messageOf } from "@/lib/api";
import { allowedPath, homeFor } from "@/lib/access";

/** Accepte uniquement un chemin interne (pas d'URL externe ni de `//`). */
function safeNext(value, user) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  return allowedPath(user, value) ? value : null;
}

export default function ConnexionPage() {
  const { status, user, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  // Deja connecte : on renvoie vers l'espace adapte aux droits.
  useEffect(() => {
    if (status === "authenticated" && !pending) router.replace(homeFor(user));
  }, [status, user, pending, router]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const signedIn = await login(email.trim(), password);
      const next = safeNext(new URLSearchParams(window.location.search).get("next"), signedIn);
      router.replace(next ?? homeFor(signedIn));
    } catch (caught) {
      setError(caught);
      setPassword("");
      setPending(false);
    }
  }

  const notVerified = error instanceof ApiError && error.code === "ACCOUNT_INVITED";

  return (
    <AuthCard
      title="Connexion"
      intro="Accédez à votre espace client Comexa pour suivre vos commandes et vos projets."
      footer={
        <>
          Pas encore de compte ?{" "}
          <Link href="/inscription" className="font-medium text-[var(--comexa-accent-strong)] hover:underline">
            Créer un compte
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        {error ? (
          <Notice>
            <p>{messageOf(error)}</p>
            {notVerified ? (
              <p className="mt-2">
                <Link href="/verify-email" className="font-medium underline">
                  Renvoyer le lien de vérification
                </Link>
              </p>
            ) : null}
          </Notice>
        ) : null}

        <Field id="email" label="Adresse e-mail">
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field id="password" label="Mot de passe">
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </Field>

        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Connexion…" : "Se connecter"}
        </button>

        <p className="text-center text-[14px]">
          <Link href="/mot-de-passe-oublie" className="text-[var(--comexa-accent-strong)] hover:underline">
            Mot de passe oublié ?
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
